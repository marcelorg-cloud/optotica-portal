-- Test-only snapshot of the quantitative reservation schema/function.
-- Read-only pg_catalog inspection on 2026-10-13; no rows or credentials copied.
create table public.regente10_ai_calls (
id uuid not null default gen_random_uuid(),
owner_id uuid not null,
mission_id uuid not null,
kind text not null,
slot integer not null default 0,
status text not null default 'reservado'::text,
response_excerpt text,
created_at timestamp with time zone not null default now(),
CHECK ((kind = ANY (ARRAY['afinamento'::text, 'resultado'::text, 'orientacao'::text, 'executor'::text]))),
FOREIGN KEY (mission_id) REFERENCES regente10_missions(id) ON DELETE CASCADE,
UNIQUE (mission_id, kind, slot),
FOREIGN KEY (owner_id) REFERENCES auth.users(id),
PRIMARY KEY (id),
CHECK (((slot >= 0) AND (slot <= 7))),
CHECK ((status = ANY (ARRAY['reservado'::text, 'confirmado'::text, 'incerto'::text, 'falhou'::text])))
);
CREATE OR REPLACE FUNCTION public.regente10_reserve_ai_call(p_mission_id uuid, p_kind text, p_slot integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare v_user uuid:=auth.uid();v_stop boolean;v_existing uuid;v_calls integer;v_id uuid;
begin
 if v_user is null or not exists(select 1 from public.system_admins where user_id=v_user and active) then raise exception 'Acesso não autorizado';end if;
 if not exists(select 1 from public.regente10_missions where id=p_mission_id and owner_id=v_user) then raise exception 'Missão inválida';end if;
 insert into public.regente10_controls(owner_id) values(v_user) on conflict(owner_id) do nothing;
 select emergency_stop into v_stop from public.regente10_controls where owner_id=v_user for update;
 if v_stop then raise exception 'Parada de emergência ativada';end if;
 if exists(select 1 from public.regente10_missions where id=p_mission_id and owner_id=v_user and paused) then raise exception 'Missão pausada';end if;
 select id into v_existing from public.regente10_ai_calls where mission_id=p_mission_id and kind=p_kind and slot=p_slot;
 if v_existing is not null then raise exception 'Etapa já reservada; não repetir sem reconciliação';end if;
 select count(*) into v_calls from public.regente10_ai_calls where owner_id=v_user;
 if v_calls >= 12 then raise exception 'Limite de 12 chamadas reservadas por Master atingido no piloto';end if;
 insert into public.regente10_ai_calls(owner_id,mission_id,kind,slot) values(v_user,p_mission_id,p_kind,p_slot) returning id into v_id;
 return v_id;
end;$function$
;

