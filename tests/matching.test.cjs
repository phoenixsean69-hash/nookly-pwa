'use strict';
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {test}=require('node:test');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');
function loadTS(file,mocks={}){
 const source=fs.readFileSync(path.join(root,'src/lib',file),'utf8');
 const result=ts.transpileModule(source,{fileName:file,reportDiagnostics:true,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}});
 const errors=(result.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error);
 assert.equal(errors.length,0,errors.map(e=>ts.flattenDiagnosticMessageText(e.messageText,' ')).join('\n'));
 const module={exports:{}};
 new Function('require','module','exports',result.outputText)((id)=>{
  if(id in mocks)return mocks[id];
  throw new Error('Unexpected import '+id);
 },module,module.exports);
 return module.exports;
}
const m=loadTS('matching.ts');
const base={userId:'me',gender:'female',preferredGender:'any',userType:'student',preferredRoommateType:'Any',budget:100,preferredLocation:'Bindura',lifestyle:['Quiet','Study-focused'],moveInDate:'2027-02-01',lookingFor:'roommate',isActive:true};
const other={...base,userId:'another'};
test('identical complete profiles have 100 alignment and 100 data coverage',()=>{
 const score=m.scoreMatch(base,other);assert.equal(score.score,100);assert.equal(score.matchCoverage,100);
});
test('no neutral points for missing evidence; only location is not eligible',()=>{
 const a={userId:'a',preferredLocation:'Bindura'},b={userId:'b',preferredLocation:'Bindura'};
 assert.equal(m.computeCompatibilityScore(a,b),0);
 assert.equal(m.isCompatibleMatch(a,b),false);
});
test('duplicate lifestyle tags cannot change score',()=>{
 const a={...base,lifestyle:['Quiet','Social']};
 const b={...other,lifestyle:['Quiet','Non-smoker']};
 assert.equal(m.computeCompatibilityScore(a,b),m.computeCompatibilityScore({...a,lifestyle:['Quiet','Quiet','Social']},b));
 assert.deepEqual(m.normalizeLifestyle('Quiet,quiet, Social'),['quiet','social']);
});
test('one shared interest across four is not perfect lifestyle alignment',()=>{
 const a={...base,lifestyle:['Quiet']},b={...other,lifestyle:['Quiet','Social','Non-smoker','Early bird']};
 assert.ok(m.computeCompatibilityScore(a,b)<85);
});
test('known city names use city over road names',()=>{
 assert.equal(m.canonicalLocation('Harare Road, Bindura'),'bindura');
 assert.equal(m.locationsOverlap('Harare','Harare Road, Bindura'),false);
 assert.equal(m.locationsOverlap('BUSE campus','Bindura'),true);
});
test('unknown areas require meaningful phrase agreement',()=>{
 assert.equal(m.locationsOverlap('Near campus','Campus Road'),false);
 assert.equal(m.locationsOverlap('Mazowe Bridge','Mazowe Bridge'),true);
});
test('hard preference is respected even when candidate gender is unknown',()=>{
 assert.equal(m.gendersCompatible({...base,preferredGender:'female'},{...other,gender:undefined}),false);
 assert.equal(m.gendersCompatible({...base,preferredGender:'any'},{...other,gender:'female',preferredGender:'male'}),false);
});
test('preferred roommate type is mutual and enforced',()=>{
 assert.equal(m.isCompatibleMatch({...base,preferredRoommateType:'Professional'},other),false);
 assert.equal(m.isCompatibleMatch({...base,preferredRoommateType:'Any'},{...other,preferredRoommateType:'Professional'}),false);
 assert.equal(m.isCompatibleMatch({...base,preferredRoommateType:'Student'},{...other,preferredRoommateType:'Any'}),true);
});
test('budget cap, hidden and self profiles are rejected',()=>{
 assert.equal(m.isCompatibleMatch(base,{...other,budget:300}),false);
 assert.equal(m.isCompatibleMatch(base,{...other,isActive:false}),false);
 assert.equal(m.isCompatibleMatch(base,{...other,userId:'me'}),false);
});
test('invalid dates never produce credit',()=>{
 assert.ok(m.computeCompatibilityScore({...base,moveInDate:'2027-02-30'},{...other,moveInDate:'2027-02-30'})<100);
});
test('ranked scores are bounded and stable, even with incomplete profiles',()=>{
 const ranks=m.rankMatches(base,[{...other,userId:'b',lifestyle:[]},{...other,userId:'a'},{...other,userId:'c',budget:180}]);
 assert.equal(ranks.length,3);assert.equal(ranks[0].userId,'a');
 for(const x of ranks){assert.ok(x.matchScore>=0&&x.matchScore<=100);assert.ok(x.matchCoverage>=0&&x.matchCoverage<=100);}
 assert.ok(ranks[1].matchScore<ranks[0].matchScore);
});
test('API filters by location before ranking and deduplicates users',async()=>{
 const items=Array.from({length:240},(_,i)=>({...other,userId:'non'+i,$id:'non'+i,preferredLocation:'Harare'}));
 items.push({...other,$id:'match1',userId:'match',preferredLocation:'BUSE'});
 items.push({...other,$id:'match2',userId:'match',preferredLocation:'BUSE'});
 let calls=0;
 const db={listDocuments:async({queries})=>{
  calls++;
  const toContains=(q)=>q?.type==='contains'?[q.value]:q?.type==='or'?q.clauses.flatMap(toContains):[];
  const terms=queries.flatMap(toContains).map(x=>x.toLowerCase());
  let docs=items.filter(d=>!terms.length||terms.some(t=>d.preferredLocation.toLowerCase().includes(t)));
  const limit=queries.find(q=>q.type==='limit')?.value||100;
  const cursor=queries.find(q=>q.type==='cursor')?.value;
  if(cursor)docs=docs.slice(Math.max(0,docs.findIndex(d=>d.$id===cursor)+1));
  return {documents:docs.slice(0,limit),total:terms.length?items.filter(d=>terms.some(t=>d.preferredLocation.toLowerCase().includes(t))).length:items.length};
 }};
 const Q={equal:(f,v)=>({type:'equal',f,v}),contains:(f,v)=>({type:'contains',f,value:v}),or:(clauses)=>({type:'or',clauses}),orderDesc:()=>({type:'order'}),limit:value=>({type:'limit',value}),cursorAfter:value=>({type:'cursor',value})};
 const api=loadTS('matchApi.ts',{'./appwrite':{databases:db,Query:Q,ID:{unique:()=>''},settings:{databaseId:'db',matchProfilesCollectionId:'coll'},requireSetting:x=>x},'./matching':m});
 const found=await api.findRoommates({...base,$id:'me'});
 assert.equal(found.locationFiltered,true);assert.equal(found.matches.length,1);
 assert.equal(found.matches[0].userId,'match');assert.equal(calls,1);
});
test('invalid Appwrite location query falls back; unauthorized does not',async()=>{
 const Q={equal:(f,v)=>({type:'equal'}),contains:()=>({type:'contains'}),or:()=>({type:'or'}),orderDesc:()=>({type:'order'}),limit:v=>({type:'limit',v}),cursorAfter:v=>({type:'cursor',v})};
 let calls=0;
 const db={listDocuments:async({queries})=>{
  calls++;
  if(queries.some(q=>q.type==='or'))throw Object.assign(new Error('Index missing'),{code:400});
  return {documents:[{...other,$id:'ok'}],total:1};
 }};
 const mocks={'./appwrite':{databases:db,Query:Q,ID:{unique:()=>''},settings:{databaseId:'db',matchProfilesCollectionId:'coll'},requireSetting:x=>x},'./matching':m};
 const api=loadTS('matchApi.ts',mocks);
 const fallback=await api.findRoommates({...base,$id:'me'});
 assert.equal(fallback.locationFiltered,false);assert.equal(fallback.matches.length,1);assert.equal(calls,2);
 db.listDocuments=async()=>{throw Object.assign(new Error('Unauthorized'),{code:401});};
 await assert.rejects(()=>api.findRoommates({...base,$id:'me'}),/Unauthorized/);
});
