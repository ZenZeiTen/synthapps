# Veld Language Reference

See README.md for the full language guide.
This file will expand to cover edge cases and grammar details.

## Grammar (informal)

```
program    = stmt*
stmt       = var_decl | fn_decl | struct_decl | impl_decl
           | module_decl | use_decl | return | if | while
           | for | match | print | break | continue | expr_stmt
var_decl   = ('let'|'const') IDENT (':' TYPE)? '=' expr
fn_decl    = 'fn' IDENT '(' params ')' ('->' TYPE)? block
struct_decl = 'struct' IDENT '{' fields '}'
impl_decl  = 'impl' IDENT '{' fn_decl* '}'
block      = '{' stmt* '}'
expr       = assign | binop | unary | call | index | dot | primary
```
