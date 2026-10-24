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
import time
import urllib.request


class DirectNative:
    def __init__(self, foundation, directory, template, template_root, ledger, key):
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
            'OPENCLAW_NO_RESPAWN':'1','OPENCLAW_SKIP_CHANNELS':'1','OPENCLAW_NO_AUTO_UPDATE':'1',
            'OPENCLAW_LAB_LIFECYCLE_LEDGER':str(ledger),'OPENROUTER_API_KEY':key}
        for name in ['home','tmp','state']:(self.directory/name).mkdir(exist_ok=True,mode=0o700)
        self.base=[str(self.foundation/'node_modules/node/bin/node'),'--import',str(self.foundation/'src/native-bootstrap.ts'),str(self.foundation/'node_modules/openclaw/openclaw.mjs')]
        self.save_config()

    def save_config(self):
        self.config.write_text(json.dumps(self.value));self.config.chmod(0o600)

    def cli(self,args,timeout=150,json_output=False):
        result=subprocess.run(self.base+args,cwd=self.directory,env=self.env,capture_output=True,text=True,timeout=timeout)
        self.events.append({'cli':args,'status':result.returncode,'stdout':result.stdout})
        if result.returncode:raise RuntimeError('Official native CLI failed: '+str(args[:2]))
        return json.loads(result.stdout) if json_output else result.stdout

    def stop(self):
        if self.child:
            self.child.terminate()
            try:self.child.wait(timeout=25)
            except subprocess.TimeoutExpired:self.child.kill();self.child.wait(timeout=5)
            self.child=None

    def start(self):
        if self.child:return
        with socket.socket() as sock:
            sock.bind(('127.0.0.1',0));self.port=sock.getsockname()[1]
        self.value['gateway']['port']=self.port;self.save_config()
        self.child=subprocess.Popen(self.base+['gateway','--port',str(self.port),'--bind','loopback'],cwd=self.directory,env=self.env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        deadline=time.monotonic()+60
        while time.monotonic()<deadline:
            if self.child.poll() is not None:raise RuntimeError('Native Gateway exited during startup')
            try:
                self.invoke('memory_search',{'query':'foundationreadinessprobe','maxResults':1},'main',start=False)
                return
            except Exception:time.sleep(.3)
        raise RuntimeError('Native readiness timed out')

    def invoke(self,tool,args,session='main',start=True):
        if start:self.start()
        body={'tool':tool,'args':args,'agentId':'main','sessionKey':'agent:main:'+session}
        request=urllib.request.Request(f'http://127.0.0.1:{self.port}/tools/invoke',data=json.dumps(body).encode(),headers={'Content-Type':'application/json','Authorization':'Bearer '+self.env['OPENCLAW_GATEWAY_TOKEN']})
        with urllib.request.urlopen(request,timeout=40) as result:value=json.load(result);status=result.status
        self.http.append({'request':body,'response':value,'status':status})
        if not value.get('ok'):raise RuntimeError('Native tool failed')
        answer=value['result']
        if 'details' in answer:return answer['details']
        return json.loads(next(c['text'] for c in answer['content'] if c['type']=='text'))

    def write(self,scope,note_id,text):
        # Direct host Markdown adapter, not an upstream write endpoint.
        target=self.notes/(note_id+'.md');temporary=self.notes/('.'+secrets.token_hex(8)+'.tmp')
        data=text if text.endswith('\n') else text+'\n'
        with temporary.open('x') as stream:stream.write(data)
        temporary.chmod(0o600);os.replace(temporary,target)
        self.events.append({'fileWrite':f'memory/{note_id}.md','text':data})
        return {'adapter':'Markdown write','path':f'memory/{note_id}.md','needsIndex':True}

    def write_daily(self,scope,day,text):return self.write(scope,day,text)
    def index(self,scope):self.stop();return self.cli(['memory','index','--force','--agent','main'])
    def search(self,scope,query):return self.invoke('memory_search',{'query':query,'maxResults':8,'minScore':0},scope.session)
    def get(self,scope,path,**kwargs):return self.invoke('memory_get',{'path':path,'from':kwargs.get('start',1),'lines':kwargs.get('lines',40)})
    def close(self):self.stop()

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
