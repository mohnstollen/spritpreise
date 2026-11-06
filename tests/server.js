// Minimaler statischer Server für die Tests (die App ist eine einzelne HTML-Datei)
const http=require('http'),fs=require('fs'),path=require('path');
const root=path.join(__dirname,'..');
const types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.json':'application/json','.webmanifest':'application/manifest+json'};
http.createServer((req,res)=>{
  const p=path.normalize(decodeURIComponent(new URL(req.url,'http://x').pathname)).replace(/^[/\\]+/,'')||'index.html';
  const f=path.join(root,p);
  if(!f.startsWith(root+path.sep)){res.writeHead(403);return res.end()}
  fs.readFile(f,(err,data)=>{
    if(err){res.writeHead(404);return res.end()}
    res.writeHead(200,{'content-type':types[path.extname(f)]||'application/octet-stream'});res.end(data);
  });
}).listen(8767);
