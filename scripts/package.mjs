import {readFile,writeFile,mkdir} from "node:fs/promises";
import {createHash} from "node:crypto";
const manifest=JSON.parse(await readFile("manifest.json","utf8"));
if(manifest.id!=="sidebar-columns" || !/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error("Unexpected distribution identity");
const names=["manifest.json","main.js","styles.css"];
function crc32(buffer){let crc=0xffffffff;for(const byte of buffer){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return(crc^0xffffffff)>>>0;}
let offset=0;const entries=[],records=[],hashes={};
for(const name of names){
 const contents=await readFile(name);if(!contents.length)throw new Error("Empty distribution file: "+name);
 const filename=Buffer.from(manifest.id+"/"+name);
 const crc=crc32(contents);
 const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50,0);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt16LE(33,12);header.writeUInt32LE(crc,14);header.writeUInt32LE(contents.length,18);header.writeUInt32LE(contents.length,22);header.writeUInt16LE(filename.length,26);
 entries.push(header,filename,contents);
 const record=Buffer.alloc(46);record.writeUInt32LE(0x02014b50,0);record.writeUInt16LE(20,4);record.writeUInt16LE(20,6);record.writeUInt16LE(0x800,8);record.writeUInt16LE(33,14);record.writeUInt32LE(crc,16);record.writeUInt32LE(contents.length,20);record.writeUInt32LE(contents.length,24);record.writeUInt16LE(filename.length,28);record.writeUInt32LE(offset,42);
 records.push(record,filename);offset+=header.length+filename.length+contents.length;
 hashes[name]=createHash("sha256").update(contents).digest("hex");
}
const central=Buffer.concat(records);const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(names.length,8);end.writeUInt16LE(names.length,10);end.writeUInt32LE(central.length,12);end.writeUInt32LE(offset,16);
await mkdir("dist",{recursive:true});
const zip=Buffer.concat([...entries,central,end]);const destination="dist/sidebar-columns-"+manifest.version+".zip";
await writeFile(destination,zip);
await writeFile("dist/checksums.json",JSON.stringify({version:manifest.version,files:hashes,zipSha256:createHash("sha256").update(zip).digest("hex")},null,2)+"\n");
console.log(destination+" ("+zip.length+" bytes)");
