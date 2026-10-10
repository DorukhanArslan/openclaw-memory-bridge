# Runtime dependency attribution

This foundation supervises the external **OpenClaw 2026.9.9** runtime through its CLI and Gateway. The runtime and its transitive dependencies are installed from the official npm registry; their source is not vendored into this repository. `package-lock.json` records the exact dependency tree. Installed packages retain their own licenses and notices, including OpenClaw's `LICENSE` and `THIRD_PARTY_NOTICES.md`.

OpenClaw's upstream source and license: [openclaw/openclaw](https://github.com/openclaw/openclaw), [MIT license](https://github.com/openclaw/openclaw/blob/main/LICENSE). The following MIT notice is reproduced from the installed pinned release. It applies to OpenClaw, rather than granting a license for this repository's original adapter code.

```text
MIT License

Copyright (c) 2026 OpenClaw Foundation

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
