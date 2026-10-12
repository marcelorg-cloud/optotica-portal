"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict");
const {evaluate,resourceEligibility,mapForMission}=require("../lib/s00-policy.js");
const mission={id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",project:"ensavim",paused:false,envelope_approved_at:null};
const project={id:"ensavim",status:"active"};
const participant={id:"F3",lifecycle:"active",project_scopes:["*"]};
const common={alias:"INST/REGENTE-RLS",owner_kind:"institute",owner_project:null,share_category:"institutional_common",data_class:"internal",shared_projects:[],allowed_operations:["status.read"],lifecycle:"active"};
const route={id:"RT-F3-RLS",participant_id:"F3",resource_alias:"INST/REGENTE-RLS",operation:"status.read",availability:"configured",project_scopes:["*"],write_enabled:false,data_class_max:"internal",cost_known:true,unit_cost:0};
const params={project,mission,participant,resource:common,route,operation:"status.read",approvedOps:[]};
test("I-01 exclusive Optotica resource denied to ENSAVIM",()=>{
 const resource={...common,owner_kind:"project",owner_project:"optotica",share_category:"exclusive",shared_projects:[]};
 const d=resourceEligibility("ensavim",resource);assert.equal(d.allowed,false);assert(d.reasons.includes("sem_base_de_acesso_E14b"));
});
test("I-02 institutional sharing means eligibility, not operative permission",()=>{
 assert.equal(resourceEligibility("ensavim",common).allowed,true);
 const d=evaluate(params);assert.equal(d.scenario,"would_deny");assert(d.reasons.includes("envelope_nao_autoriza_operacao"));assert.equal(d.operativeAuthorization,false);
});
test("I-03 inactive project never qualifies",()=>{
 const d=evaluate({...params,project:{...project,status:"proposed"},approvedOps:["status.read"],mission:{...mission,envelope_approved_at:"2026-10-12T12:00:00Z"}});
 assert.equal(d.scenario,"would_deny");assert(d.reasons.includes("projeto_nao_ativo"));
});
test("I-06 restricted parent requires explicit, verified child exception",()=>{
 const parent={alias:"G-OPT",owner_kind:"project",owner_project:"optotica",share_category:"exclusive",data_class:"personal",lifecycle:"active"};
 const child={...common,alias:"G-OPT/ENSAVIM-APOIO",owner_kind:"project",owner_project:"optotica",share_category:"shared",data_class:"internal",shared_projects:["ensavim"]};
 const denied=resourceEligibility("ensavim",child,[parent]);assert.equal(denied.allowed,false);
 const allowed=resourceEligibility("ensavim",{...child,policy_decision_ref:"DM4-CS-OPT-01"},[parent]);assert.equal(allowed.allowed,true);
});
test("I-07 personal data cannot be shared by institutional eligibility",()=>{
 const result=resourceEligibility("ensavim",{...common,data_class:"personal"});assert.equal(result.allowed,false);
 assert(result.reasons.includes("dados_pessoais_ou_sensiveis_sem_CE14"));
});
test("I-16 wrong participant scope blocks cross project",()=>{
 const d=evaluate({...params,participant:{id:"A1",lifecycle:"active",project_scopes:["optotica","born-robot"]}});
 assert(d.reasons.includes("escopo_participante_E14a"));
});
test("I-17 personal root never substitutes Optotica destination for writing",()=>{
 const personal={alias:"G-PES",owner_kind:"person",share_category:"restricted",data_class:"personal",lifecycle:"proposed",shared_projects:[]};
 const r=resourceEligibility("ensavim",personal);assert.equal(r.allowed,false);
});
test("no env authorization from textual agent claim",()=>{
 const d=evaluate({...params,mission:{...mission,envelope_approved_at:"2026-10-12T12:00:00Z",approved:true},approvedOps:[]});
 assert.equal(d.scenario,"would_deny");
});
test("missing route or unknown cost denies by default",()=>{
 assert(evaluate({...params,route:null}).reasons.includes("rota_nao_equivalente"));
 assert(evaluate({...params,route:{...route,cost_known:false,unit_cost:null}}).reasons.includes("custo_unitario_desconhecido"));
});
test("out-of-scope route cannot gain permission from resource sharing",()=>{
 const d=evaluate({...params,route:{...route,project_scopes:["optotica"]}});
 assert(d.reasons.includes("rota_nao_disponivel_ou_escopo"));
});
test("emergency stop always denies",()=>{
 const d=evaluate({...params,emergency:true,approvedOps:["status.read"],mission:{...mission,envelope_approved_at:"2026-10-12T12:00:00Z"}});
 assert(d.reasons.includes("parada_de_emergencia"));
});
test("simulation can say would_allow but NEVER authorizes or dispatches",()=>{
 const d=evaluate({...params,approvedOps:["status.read"],mission:{...mission,envelope_approved_at:"2026-10-12T12:00:00Z"}});
 assert.equal(d.scenario,"would_allow");
 assert.equal(d.operativeAuthorization,false);assert.equal(d.dispatched,false);
});
test("T10 deterministic connection selection hash",()=>{
 const ms={...mission},projects=[project],participants=[participant],resources=[common],routes=[route];
 const a=mapForMission(ms,projects,participants,resources,routes,[]);
 const b=mapForMission(ms,projects,participants,resources,routes,[]);
 assert.equal(a.selectionHash,b.selectionHash);assert.equal(a.externalWritingEnabled,false);
 assert(a.links.every(x=>x.activeRoute===null));
});
test("new Institute governance mission uses its own scope only",()=>{
 const ms={...mission,project:"instituto-governanca"},projects=[{id:"instituto-governanca",status:"active"}],participants=[{id:"A4",lifecycle:"active",project_scopes:["*"]}],res=[common],routes=[];
 const plan=mapForMission(ms,projects,participants,res,routes,[]);
 assert(plan.links.some(x=>x.operator==="A4"));
 assert(!plan.links.some(x=>x.operator==="A1"));
});
