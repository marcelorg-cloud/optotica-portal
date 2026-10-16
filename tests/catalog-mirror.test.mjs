import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
function moduleFrom(path,overrides={}){
 const file=new URL(path,import.meta.url);
 const text=fs.readFileSync(file,'utf8');
 const transformed=ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const mod={exports:{}};
 new Function('require','module','exports',transformed)((x)=>overrides[x]??require(x),mod,mod.exports);
 return mod.exports;
}
const list=moduleFrom('../lib/catalog/parse-supplier-list.ts');
const mirror=moduleFrom('../lib/catalog/mirror-batch.ts',{'./parse-supplier-list':list});

test('seller mirror accepts real-format DataHub resultList.item and filters accessories',()=>{
 const raw=JSON.stringify({result:{storeId:'123456',resultList:[
  {item:{itemId:1005001122334455,title:'Titanium Optical Eyeglasses Frame',image:'//ae-pic.example/frame.jpg',promotionPrice:'10.50'}},
  {item:{itemId:1005001234567890,title:'Glasses Cleaner & Carrying Case',image:'//ae-pic.example/case.jpg'}},
  {item:{itemId:1005001122334455,title:'Repeated listing'}}
 ]}});
 const batch=mirror.parseMirrorBatch(raw,'123456');
 assert.equal(batch.sourceCount,2);
 assert.equal(batch.candidates.length,1);
 assert.equal(batch.candidates[0].itemId,'1005001122334455');
 assert.equal(batch.candidates[0].imageUrl,'https://ae-pic.example/frame.jpg');
 assert.equal(batch.candidates[0].price,'10.50');
 assert.equal(batch.storeVerified,true);
 assert.equal(batch.filteredCount,1);
});
test('unverified store attribution never becomes verified from missing storeId',()=>{
 const batch=mirror.parseMirrorBatch(JSON.stringify({items:[
  {itemId:'1005009988776655',title:'Acetate Optical Frames'}
 ]}),'123456');
 assert.equal(batch.storeVerified,false);
 assert.equal(batch.candidates.length,1);
});
test('explicit mismatched supplier store ID is rejected before import',()=>{
 const raw=JSON.stringify({storeId:'987654',items:[{itemId:'1005001111222233',title:'Metal Eyeglasses Frame'}]});
 assert.throws(()=>mirror.parseMirrorBatch(raw,'123456'),/pertence à loja/);
});
test('allListings mode includes other supplier items for human triage',()=>{
 const raw=JSON.stringify({storeId:'123456',items:[
  {itemId:'1005005555444433',title:'Cleaning Cloth Accessory'},
  {itemId:'1005008888777766',title:'Rimless Optical Frame'}
 ]});
 const filtered=mirror.parseMirrorBatch(raw,'123456');
 const all=mirror.parseMirrorBatch(raw,'123456',{allListings:true});
 assert.equal(filtered.candidates.length,1);
 assert.equal(all.candidates.length,2);
});
test('one megabyte payload bound prevents oversize supplier import',()=>{
 assert.throws(()=>mirror.parseMirrorBatch('x'.repeat(1_000_001),'123456'),/1 MB/);
});
test('unknown material or format is never inferred from the title',()=>{
 const raw=JSON.stringify({storeId:'123456',items:[{itemId:'1005001111222233',title:'Retro Women TR90 Square Frame'}]});
 const batch=mirror.parseMirrorBatch(raw,'123456');
 assert.equal(batch.candidates.length,1);
 assert.equal('formatCode' in batch.candidates[0],false);
 assert.equal('materialCode' in batch.candidates[0],false);
});
