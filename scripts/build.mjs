import {mkdirSync, rmSync, copyFileSync} from 'node:fs';
// Only these two files may be exposed as static assets. Runtime libraries are
// bundled into the function separately, never copied to the public directory.
rmSync(new URL('../public/',import.meta.url),{recursive:true,force:true});
mkdirSync(new URL('../public/',import.meta.url),{recursive:true});
for(const name of ['index.html','site-config.js'])copyFileSync(new URL('../'+name,import.meta.url),new URL('../public/'+name,import.meta.url));
