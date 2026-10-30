import {cp,mkdir,readFile,readdir} from 'node:fs/promises';
const root=new URL('../',import.meta.url), output=new URL('../dist-pages/',import.meta.url);
await mkdir(output,{recursive:true});
await cp(new URL('apps/label-print/public/',root),output,{recursive:true});
await cp(new URL('apps/scale-print/public/',root),new URL('scale-test/',output),{recursive:true});
// Verify both published entry points against their own authored public directories.
async function verify(source,target) {
  for(const entry of await readdir(source,{withFileTypes:true})) {
    const left=new URL(entry.name+(entry.isDirectory()?'/':''),source),right=new URL(entry.name+(entry.isDirectory()?'/':''),target);
    if(entry.isDirectory())await verify(left,right);
    else if(!(await readFile(left)).equals(await readFile(right)))throw new Error(`Existing page changed: ${entry.name}`);
  }
}
await verify(new URL('apps/label-print/public/',root),output);
await verify(new URL('apps/scale-print/public/',root),new URL('scale-test/',output));
console.log('Pages packaged: production scale printing at /; separate scale test at /scale-test/');
