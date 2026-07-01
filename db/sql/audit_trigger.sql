create or replace function fl_audit() returns trigger as $$
declare rid int;
begin
  rid := coalesce(new.id, old.id);
  insert into audit_log(table_name, row_id, action, actor, diff)
  values (tg_table_name, rid, lower(tg_op)::audit_action,
          current_setting('fl.actor', true),
          case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end);
  return coalesce(new, old);
end; $$ language plpgsql;

create or replace trigger audit_regulation after insert or update or delete on regulation
  for each row execute function fl_audit();
