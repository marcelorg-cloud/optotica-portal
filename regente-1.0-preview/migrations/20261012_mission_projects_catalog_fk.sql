-- Correct earlier pilot fixed project CHECK: DM10 Institute Governance is a valid project.
-- The institution registry becomes the project foreign-key source.
-- This does NOT grant authorization: API requires an active project and Master ownership RLS.
alter table public.regente10_missions drop constraint if exists regente10_missions_project_check;
alter table public.regente10_missions add constraint regente10_missions_project_catalog_fk
  foreign key(project) references public.regente10_projects(id)
  on update restrict on delete restrict;
