import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../dist-pages/',import.meta.url));
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.lbx':'application/octet-stream'};
http.createServer(async(req,res)=>{
  try {
    let filename=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
    const relative=path.relative(root,filename);
    if(relative.startsWith('..')||path.isAbsolute(relative)){res.writeHead(403).end();return;}
    if((await stat(filename)).isDirectory())filename=path.join(filename,'index.html');
    res.writeHead(200,{'Content-Type':types[path.extname(filename)]||'application/octet-stream','Cache-Control':'no-store'}).end(await readFile(filename));
  }catch{res.writeHead(404).end('Not found');}
}).listen(4184,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:4184/scale-test/'));
