"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict");
const budget=require("../lib/ai-budget.js");
const ID="22222222-2222-4222-8222-222222222222";
const JOB="33333333-3333-4333-8333-333333333333";
test("estimated text payload bytes include UTF-8 size, not JS character count",()=>{
 assert.equal(budget.inputBytes("á","🧪"),6);
});
test("new textual reservation passes bounded model, prompt bytes and cap to DB",async()=>{
 const calls=[];
 const db=async(token,path,opts)=>{calls.push({token,path,opts});return JOB};
 const job=await budget.reserve(db,"fake.auth.test",{missionId:ID,kind:"resultado",slot:0,model:"gpt-4.1-mini",system:"system",user:"Português",maxOutput:1800});
 assert.equal(job,JOB);
 const data=JSON.parse(calls[0].opts.body);
 assert.equal(calls[0].path,"rpc/regente10_reserve_ai_budget");
 assert.equal(data.p_input_bytes,Buffer.byteLength("systemPortuguês","utf8"));assert.equal(data.p_max_output,1800);
});
test("missing token usage is explicitly sent for uncertain reserve retention",async()=>{
 let data;
 await budget.settle(async(_t,_p,o)=>{data=JSON.parse(o.body);return {state:"uncertain"}},"x",JOB,null);
 assert.equal(data.p_input_tokens,null);assert.equal(data.p_output_tokens,null);assert.equal(data.p_cached_tokens,null);
});
test("token settlement preserves cached usage report",async()=>{
 let data;
 await budget.settle(async(_t,_p,o)=>{data=JSON.parse(o.body);return {state:"settled"}},"x",JOB,{prompt_tokens:200,completion_tokens:100,prompt_tokens_details:{cached_tokens:25}});
 assert.equal(data.p_input_tokens,200);assert.equal(data.p_cached_tokens,25);assert.equal(data.p_output_tokens,100);
});
test("budget reservation fails closed on missing ID returned from DB",async()=>{
 await assert.rejects(()=>budget.reserve(async()=>null,"x",{missionId:ID,kind:"resultado",slot:0,system:"abc",user:"xyz",maxOutput:1800}),/não confirmada/);
});
