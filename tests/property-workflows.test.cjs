'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const user = {$id:'profile01',accountId:'tenant01',name:'Alex',email:'alex@example.com',userMode:'tenant',phone:'0770000000',avatar:'https://example.test/avatar'};
const landlord = {...user,$id:'landlordprofile',accountId:'landlord01',userMode:'landlord',name:'Landlord'};
function harness(config={}){
  const stored=new Map();
  const ops=[];
  const configProps={...config};
  const settings={databaseId:'db',propertiesCollectionId:'properties',likesCollectionId:'likes',requestsCollectionId:'requests',bucketId:'bucket',usersCollectionId:'users'};
  const sample={ $id:'p1',creatorId:'landlord01',propertyName:'Bindura rooms',price:120,priceThreshold:90,availableSlots:2,totalSlots:3,occupiedSlots:1,isAvailable:true,likes:0,views:0,reviews:'[]'};
  stored.set('properties:p1', {...sample,...configProps.property});
  const queries={equal:(key,val)=>['eq',key,val],limit:(val)=>['limit',val],orderDesc:(val)=>['orderDesc',val]};
  const databases={
    getDocument:async ({collectionId,documentId})=>{ops.push(['get',collectionId,documentId]);const val=stored.get(collectionId+':'+documentId);if(!val)throw new Error('404');return {...val}},
    createDocument:async ({collectionId,documentId,data})=>{ops.push(['create',collectionId,data]);const row={$id:documentId,...data};stored.set(collectionId+':'+documentId,row);return row},
    updateDocument:async ({collectionId,documentId,data})=>{ops.push(['update',collectionId,data]);const item=stored.get(collectionId+':'+documentId);if(!item)throw new Error('404');const next={...item,...data};stored.set(collectionId+':'+documentId,next);return next},
    deleteDocument:async ({collectionId,documentId})=>{ops.push(['delete',collectionId,documentId]);stored.delete(collectionId+':'+documentId)},
    listDocuments:async ({collectionId,queries:filter})=>{
      ops.push(['list',collectionId,filter]);const rows=Array.from(stored.entries()).filter(([k])=>k.startsWith(collectionId+':')).map(([,r])=>r);
      const filtered=rows.filter(row=>filter.filter(f=>f[0]==='eq').every(([,key,val])=>Array.isArray(val)?val.includes(row[key]):row[key]===val));
      return {documents:filtered.slice(0,filter.find(f=>f[0]==='limit')?.[1]||100),total:filtered.length};
    },
  };
  const appwrite={databases,account:{get:async()=>({$id:config.sessionId||'tenant01'})},ID:{unique:()=>`new${stored.size}`},Query:queries,settings,requireSetting:(value)=>{if(!value)throw Error('missing setting');return value},storage:{createFile:async()=>({$id:'fileA'}),getFileView:()=>new URL('https://example.test/img')}};
  const filename=path.resolve(__dirname,'../src/lib/propertyWorkflows.ts');
  const out=ts.transpileModule(fs.readFileSync(filename,'utf8'),{fileName:filename,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}};
  const localStorage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
  const context={module,exports:module.exports,require:(id)=>{if(id==='appwrite')return {Permission:{read:v=>'read:'+v,update:v=>'update:'+v},Role:{user:id=>'user:'+id}};if(id==='./appwrite')return appwrite;if(id==='./auth')return {getPwaAccountId:()=>config.marker||'tenant01'};throw Error('Unknown import: '+id)},navigator:{onLine:true},localStorage,Date,URL,Number,JSON,console,Error,Set,Map,String};
  vm.runInNewContext(out,context,{filename});
  return {...module.exports,ops,stored,appwrite};
}
const draft={propertyName:'Home in Bindura',type:'Boarding',description:'A comfortable furnished boarding house.',address:'123 Main Road, Bindura',price:120,priceThreshold:90,area:100,roomFor:2,bedrooms:2,bathrooms:1,totalSlots:5,availableSlots:0,isAvailable:true,facilities:'Water, Wi-Fi',curfew:'',latitude:-17.3,longitude:31.3};

test('full boarding house automatically becomes unavailable',()=>{const x=harness();assert.equal(x.listingData(draft).isAvailable,false);assert.equal(x.listingData({...draft,availableSlots:3}).occupiedSlots,2)});
test('manual pause cannot be overridden by available beds',()=>{const x=harness();assert.equal(x.listingData({...draft,availableSlots:4,isAvailable:false}).isAvailable,false)});
test('validates bed availability and coordinates',()=>{const x=harness();assert.throws(()=>x.validateListing({...draft,totalSlots:2,availableSlots:3}),/exceed/);assert.throws(()=>x.validateListing({...draft,latitude:200}),/latitude/)});
test('mobile review format parses safely, ignores invalid values',()=>{const x=harness();const rs=x.readReviews(JSON.stringify([{id:'x',rating:5,review:'Good place',userName:'Alex'},{rating:99,review:'invalid'}]));assert.equal(rs.length,1);assert.equal(x.summarizeReviews(rs).average,5)});
test('review prevents posting on own property',async()=>{const x=harness({sessionId:'landlord01',marker:'landlord01'});await assert.rejects(()=>x.postReview(landlord,'p1','Decent place to rent',5),/own property/)});
test('review requires same session, creates mobile-compatible review record',async()=>{const x=harness();await x.postReview(user,'p1','The room is tidy and safe',4);const reviews=JSON.parse(x.stored.get('properties:p1').reviews);assert.equal(reviews[0].reviewerId,'tenant01');assert.equal(reviews[0].rating,4);await assert.rejects(()=>x.postReview(user,'p1','Another legitimate review',5),/already reviewed/)});
test('rejects a mismatched Appwrite session',async()=>{const x=harness({sessionId:'otherAccount'});await assert.rejects(()=>x.assertSession(user),/session changed/)});
test('prevents sub-threshold requests',async()=>{const x=harness();await assert.rejects(()=>x.submitRentalRequest(user,'p1',{proposedPrice:50,message:'Please arrange a viewing',moveInDate:'',leaseDuration:'',questions:[]}),/minimum rental offer/)});
test('request uses mobile schema, prevents duplicate active requests',async()=>{const x=harness();const r=await x.submitRentalRequest(user,'p1',{proposedPrice:110,message:'I would like to view the room',moveInDate:'2027-02-10',leaseDuration:'6 months',questions:[]});assert.equal(r.tenantId,'tenant01');assert.equal(r.status,'pending');await assert.rejects(()=>x.submitRentalRequest(user,'p1',{proposedPrice:110,message:'A second enquiry',moveInDate:'',leaseDuration:'',questions:[]}),/already have an active request/)});
test('like records saved and count synchronized',async()=>{const x=harness();const result=await x.togglePropertyLike(user,'p1');assert.equal(result.liked,true);assert.equal(result.total,1);const result2=await x.togglePropertyLike(user,'p1');assert.equal(result2.total,0)});
test('landlord can create listing with correct creator references',async()=>{const x=harness({sessionId:'landlord01',marker:'landlord01'});const p=await x.createListing(landlord,{...draft,availableSlots:3});assert.equal(p.creatorId,'landlord01');assert.equal(p.agent,'landlordprofile')});
test('only landlord owner can edit listings',async()=>{const x=harness();await assert.rejects(()=>x.editListing(user,'p1',{...draft,availableSlots:1}),/Landlord access required/)});
test('landlord response updates request and bed count',async()=>{const x=harness({sessionId:'landlord01',marker:'landlord01'});const req={$id:'req1',propertyId:'p1',propertyName:'Rooms',tenantId:'tenant01',status:'pending'};x.stored.set('requests:req1',req);const result=await x.updateRentalRequest(landlord,req,[x.stored.get('properties:p1')],'approved');assert.equal(result.status,'approved');assert.equal(x.stored.get('properties:p1').availableSlots,1);assert.equal(x.stored.get('requests:req1').status,'approved')});
test('repeat approval cannot consume another bed',async()=>{const x=harness({sessionId:'landlord01',marker:'landlord01'});const req={$id:'req1',propertyId:'p1',status:'approved'};x.stored.set('requests:req1',req);await assert.rejects(()=>x.updateRentalRequest(landlord,req,[x.stored.get('properties:p1')],'approved'),/no longer pending/)});
