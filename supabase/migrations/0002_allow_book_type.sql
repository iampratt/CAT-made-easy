alter table questions drop constraint if exists questions_type_check;
alter table questions add constraint questions_type_check check (type in ('past_paper', 'book', 'generated'));
