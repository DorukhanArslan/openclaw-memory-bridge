"""Independent test driver of public OpenClaw CLI, HTTP and Markdown sources.
No Lab, FoundationClient, stdio dispatcher or private engine functions are used.
"""
from __future__ import annotations
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import threading
import time
import urllib.request
import urllib.error


class DirectNative:
    def __init__(self, foundation, directory, template, template_root, ledger, key, *, trace=None):
        self.foundation, self.directory = Path(foundation), Path(directory)
        self.directory.mkdir(parents=True,exist_ok=True,mode=0o700)
        self.workspace=self.directory/'workspace';self.notes=self.workspace/'memory'
        self.notes.mkdir(parents=True,exist_ok=True,mode=0o700)
        self.config=self.directory/'config.json';self.child=None;self.events=[];self.http=[]
        self.value=json.loads(json.dumps(template).replace(str(template_root),str(self.directory)))
        self.value['logging']['file']=str(self.directory/'openclaw.log')
        self.value['cron']={'enabled':False}
        self.env={'PATH':str(self.foundation/'node_modules/node/bin')+':/usr/bin:/bin','HOME':str(self.directory/'home'),
            'TMPDIR':str(self.directory/'tmp'),'LANG':'en_US.UTF-8','OPENCLAW_HOME':str(self.directory/'home'),
            'OPENCLAW_STATE_DIR':str(self.directory/'state'),'OPENCLAW_CONFIG_PATH':str(self.config),
            'OPENCLAW_GATEWAY_TOKEN':secrets.token_hex(32),'OPENCLAW_DISABLE_BONJOUR':'1','OPENCLAW_EXEC_SHELL_SNAPSHOT':'0',
            'OPENCLAW_NO_RESPAWN':'1','OPENCLAW_SKIP_CHANNELS':'1','OPENCLAW_NO_AUTO_UPDATE':'1'}
        if ledger is not None:self.env['OPENCLAW_LAB_LIFECYCLE_LEDGER']=str(ledger)
        if key is not None:self.env['OPENROUTER_API_KEY']=key
        self.trace=trace
        self._stream_operation=None;self._stream_threads=[];self._stream_buffers={};self._stream_errors=[];self._stream_pipes={}
        self._stream_limit=8*1024*1024
        if trace:
            trace.add_secret(key)
            trace.add_secret(self.env['OPENCLAW_GATEWAY_TOKEN'])
            trace.add_secret(self.value.get('gateway',{}).get('auth',{}).get('token'))
            trace.begin_generation('direct-native')
        for name in ['home','tmp','state']:(self.directory/name).mkdir(exist_ok=True,mode=0o700)
        self.base=[str(self.foundation/'node_modules/node/bin/node'),'--import',str(self.foundation/'src/native-bootstrap.ts'),str(self.foundation/'node_modules/openclaw/openclaw.mjs')]
        self.save_config()

    def save_config(self):
        self.config.write_text(json.dumps(self.value));self.config.chmod(0o600)

    def cli(self,args,timeout=150,json_output=False):
        operation=self.trace.start('cli',{'args':args,'argv':self.base+args,'cwd':str(self.directory),'timeoutSeconds':timeout}) if self.trace else None
        started=time.monotonic_ns()
        try:
            result=subprocess.run(self.base+args,cwd=self.directory,env=self.env,capture_output=True,timeout=timeout)
        except BaseException as error:
            if self.trace:self.trace.end(operation,'cli.error',{'errorType':type(error).__name__,
                'stdout':getattr(error,'stdout',None),'stderr':getattr(error,'stderr',None),
                'elapsedNs':str(time.monotonic_ns()-started),'timedOut':isinstance(error,subprocess.TimeoutExpired)})
            raise
        if self.trace:self.trace.end(operation,'cli.result',{'status':result.returncode,'stdout':result.stdout,
            'stderr':result.stderr,'elapsedNs':str(time.monotonic_ns()-started)})
        try:
            stdout=result.stdout.decode('utf-8')
            self.events.append({'cli':args,'status':result.returncode,'stdout':stdout})
            if result.returncode:raise RuntimeError('Official native CLI failed: '+str(args[:2]))
            return json.loads(stdout) if json_output else stdout
        except (ValueError,UnicodeError) as error:
            if self.trace:self.trace.record('cli.decode_error',{'errorType':type(error).__name__,'args':args})
            raise

    def _collect_stream(self, child, name, stream):
        # Collectors never write journals. Redaction happens on the main thread
        # after both complete streams have been joined, including split tokens.
        try:
            while True:
                chunk=stream.read1(65536)
                if not chunk:break
                target=self._stream_buffers[name]
                if len(target)+len(chunk)>self._stream_limit:
                    self._stream_errors.append(name+' exceeded the complete-stream bound')
                    child.kill()
                    break
                target.extend(chunk)
        except BaseException:
            self._stream_errors.append(name+' could not be completely read')
            try:child.kill()
            except OSError:pass
        finally:stream.close()

    def _capture_streams(self, child):
        self._stream_buffers={'stdout':bytearray(),'stderr':bytearray()}
        self._stream_pipes={'stdout':child.stdout,'stderr':child.stderr}
        self._stream_errors=[];self._stream_threads=[]
        for name in ['stdout','stderr']:
            thread=threading.Thread(target=self._collect_stream,args=(child,name,getattr(child,name)),name='trace-'+name,daemon=True)
            self._stream_threads.append(thread)
            try:thread.start()
            except BaseException:
                self._stream_errors.append(name+' collector did not start')
                raise

    def _finish_streams(self, status):
        if not self.trace or self._stream_operation is None:return
        for thread in self._stream_threads:
            if thread.ident is not None:thread.join(timeout=5)
            if thread.is_alive():self._stream_errors.append('stream collector did not finish')
        for name,stream in self._stream_pipes.items():
            if not any(thread.name=='trace-'+name and thread.is_alive() for thread in self._stream_threads):
                stream.close()
        if status is None:self._stream_errors.append('Gateway exit status was not observed')
        operation=self._stream_operation;self._stream_operation=None
        complete=not self._stream_errors
        self.trace.end(operation,'gateway.streams.result' if complete else 'gateway.streams.error',{
            'status':status,'stdout':bytes(self._stream_buffers.get('stdout',b'')),
            'stderr':bytes(self._stream_buffers.get('stderr',b'')),
            'complete':complete,'errors':self._stream_errors})
        if not complete:self.trace.fail('Native Gateway streams are incomplete.')

    def stop(self):
        if self.child:
            trace_error=None;operation=None
            if self.trace:
                try:
                    self.trace.barrier('before-gateway-stop')
                    operation=self.trace.start('gateway.stop',{'pid':self.child.pid})
                except Exception as error:trace_error=error
            status=None;process_error=None
            try:
                if self.child.poll() is None:self.child.terminate()
                try:status=self.child.wait(timeout=25)
                except subprocess.TimeoutExpired:self.child.kill();status=self.child.wait(timeout=5)
            except BaseException as error:process_error=error
            finally:self.child=None
            try:self._finish_streams(status)
            except Exception as error:trace_error=trace_error or error
            if trace_error:raise trace_error
            if process_error:raise process_error
            if self.trace:
                self.trace.end(operation,'gateway.stop.result',{'status':status})
                self.trace.barrier('gateway-stopped-streams-durable')

    def start(self):
        if self.child:return
        operation=self.trace.start('gateway',{'stdoutStderr':'separate complete streams captured on stop' if self.trace else 'not captured'}) if self.trace else None
        try:
            with socket.socket() as sock:
                sock.bind(('127.0.0.1',0));self.port=sock.getsockname()[1]
            self.value['gateway']['port']=self.port;self.save_config()
            if self.trace:
                self._stream_buffers={'stdout':bytearray(),'stderr':bytearray()}
                self._stream_threads=[];self._stream_errors=[];self._stream_pipes={}
                self._stream_operation=self.trace.start('gateway.streams',{'maxBytesPerStream':self._stream_limit,
                    'argv':self.base+['gateway','--port',str(self.port),'--bind','loopback'],'cwd':str(self.directory)})
            self.child=subprocess.Popen(self.base+['gateway','--port',str(self.port),'--bind','loopback'],cwd=self.directory,env=self.env,
                stdout=subprocess.PIPE if self.trace else subprocess.DEVNULL,stderr=subprocess.PIPE if self.trace else subprocess.DEVNULL)
            if self.trace:self._capture_streams(self.child)
            deadline=time.monotonic()+60
            while time.monotonic()<deadline:
                if self.child.poll() is not None:raise RuntimeError('Native Gateway exited during startup')
                if self._stream_errors:raise RuntimeError('Native Gateway output capture failed')
                try:
                    self.invoke('memory_search',{'query':'foundationreadinessprobe','maxResults':1},'main',start=False)
                    if self.trace:self.trace.end(operation,'gateway.ready',{'pid':self.child.pid,'port':self.port})
                    return
                except Exception:
                    if self.trace and self.trace.poisoned:raise
                    time.sleep(.3)
            raise RuntimeError('Native readiness timed out')
        except BaseException as error:
            try:
                if self.trace:self.trace.end(operation,'gateway.error',{'errorType':type(error).__name__})
            finally:
                if self.child:self.stop()
                elif self._stream_operation is not None:
                    self._stream_errors.append('Gateway process was not started')
                    self._finish_streams(None)
            raise

    def invoke(self,tool,args,session='main',start=True):
        if start:self.start()
        body={'tool':tool,'args':args,'agentId':'main','sessionKey':'agent:main:'+session}
        request=urllib.request.Request(f'http://127.0.0.1:{self.port}/tools/invoke',data=json.dumps(body).encode(),headers={'Content-Type':'application/json','Authorization':'Bearer '+self.env['OPENCLAW_GATEWAY_TOKEN']})
        operation=self.trace.start('http',{'url':request.full_url,'method':'POST','request':body}) if self.trace else None
        started=time.monotonic_ns()
        status=None
        try:
            with urllib.request.urlopen(request,timeout=40) as result:status=result.status;raw=result.read()
        except urllib.error.HTTPError as error:
            body_error=None
            try:raw=error.read()
            except BaseException as failure:raw=getattr(failure,'partial',None);body_error=failure
            finally:error.close()
            if self.trace:self.trace.end(operation,'http.error',{'status':error.code,'responseBody':raw,
                'responseBodyComplete':body_error is None,
                'errorType':type(body_error or error).__name__,'elapsedNs':str(time.monotonic_ns()-started)})
            if body_error:raise body_error
            raise
        except BaseException as error:
            if self.trace:self.trace.end(operation,'http.error',{'status':status,'errorType':type(error).__name__,
                'responseBodyComplete':False,
                'partialResponse':getattr(error,'partial',None),'elapsedNs':str(time.monotonic_ns()-started)})
            raise
        if self.trace:self.trace.end(operation,'http.result',{'status':status,'responseBody':raw,
            'responseBodyComplete':True,
            'elapsedNs':str(time.monotonic_ns()-started)})
        try:value=json.loads(raw)
        except (ValueError,UnicodeError) as error:
            if self.trace:self.trace.record('http.decode_error',{'status':status,'errorType':type(error).__name__})
            raise
        self.http.append({'request':body,'response':value,'status':status})
        if not value.get('ok'):raise RuntimeError('Native tool failed')
        answer=value['result']
        if 'details' in answer:return answer['details']
        return json.loads(next(c['text'] for c in answer['content'] if c['type']=='text'))

    def write(self,scope,note_id,text):
        # Direct host Markdown adapter, not an upstream write endpoint.
        target=self.notes/(note_id+'.md');temporary=self.notes/('.'+secrets.token_hex(8)+'.tmp')
        data=text if text.endswith('\n') else text+'\n'
        operation=self.trace.start('file.write',{'path':f'memory/{note_id}.md','text':data}) if self.trace else None
        try:
            with temporary.open('x') as stream:stream.write(data)
            temporary.chmod(0o600);os.replace(temporary,target)
        except BaseException as error:
            if self.trace:self.trace.end(operation,'file.write.error',{'errorType':type(error).__name__})
            raise
        if self.trace:self.trace.end(operation,'file.write.result',{'path':f'memory/{note_id}.md','bytes':len(data.encode('utf-8'))})
        self.events.append({'fileWrite':f'memory/{note_id}.md','text':data})
        return {'adapter':'Markdown write','path':f'memory/{note_id}.md','needsIndex':True}

    def write_daily(self,scope,day,text):return self.write(scope,day,text)
    def index(self,scope):self.stop();return self.cli(['memory','index','--force','--agent','main'])
    def search(self,scope,query):return self.invoke('memory_search',{'query':query,'maxResults':8,'minScore':0},scope.session)
    def get(self,scope,path,**kwargs):return self.invoke('memory_get',{'path':path,'from':kwargs.get('start',1),'lines':kwargs.get('lines',40)})
    def close(self):
        self.stop()
        if self.trace:self.trace.barrier('direct-native-close')

    def maintenance(self):
        self.stop()
        staged=self.cli(['memory','rem-backfill','--agent','main','--path',str(self.notes),'--stage-short-term','--json'],json_output=True)
        self.value['cron']['enabled']=True;self.save_config()
        log=self.directory/'openclaw.log';offset=len(log.read_text()) if log.exists() else 0
        try:
            self.start();job=None
            for _ in range(10):
                jobs=self.cli(['cron','list','--json'],json_output=True)['jobs']
                job=next((j for j in jobs if j.get('declarationKey')=='memory-core:memory-dreaming-promotion'),None)
                if job:break
                time.sleep(.3)
            if not job:raise RuntimeError('Native managed memory job absent')
            sweep=self.cli(['cron','run',job['id'],'--wait','--wait-timeout','180000','--json'],timeout=215,json_output=True)
            publishers={x:'pending' for x in ['light','rem','deep']};deadline=time.monotonic()+90
            while 'pending' in publishers.values() and time.monotonic()<deadline:
                content=log.read_text()[offset:]
                for phase in publishers:
                    if f'dream diary entry written for {phase} phase' in content:publishers[phase]='completed'
                    elif f'narrative generation used fallback for {phase} phase' in content:publishers[phase]='degraded'
                if 'pending' in publishers.values():time.sleep(.3)
            return {'staged':staged,'sweep':sweep,'publishers':publishers}
        finally:self.stop();self.value['cron']['enabled']=False;self.save_config()
