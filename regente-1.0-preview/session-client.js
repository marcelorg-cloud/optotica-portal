"use strict";
(()=>{
 const leave=()=>{sessionStorage.removeItem("regente10_token");sessionStorage.removeItem("regente10_refresh");document.body.hidden=true;location.replace("/login");};
 async function signOut(){document.body.hidden=true;try{const r=await fetch("/api/session",{method:"DELETE"});if(!r.ok){document.body.hidden=false;alert("Não foi possível encerrar a sessão. Tente novamente.");return;}}catch{document.body.hidden=false;alert("Não foi possível encerrar a sessão. Tente novamente.");return;}leave();}
 let button=document.getElementById("signOut");
 if(!button){button=document.createElement("button");button.textContent="Sair da conta";button.style.cssText="position:fixed;bottom:18px;right:18px;padding:10px 14px;border-radius:9px;background:#174b3d;color:white;border:1px solid white;z-index:50;cursor:pointer";document.body.append(button);}
 button.onclick=signOut;
 addEventListener("pageshow",event=>{if(event.persisted){document.body.hidden=true;location.reload();}});
 addEventListener("focus",async()=>{try{const r=await fetch("/api/session",{cache:"no-store"});if(!r.ok)leave();}catch{leave();}});
})();
