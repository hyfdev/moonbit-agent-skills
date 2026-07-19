///|
const IDENTIFIER = re"[A-Za-z_][A-Za-z0-9_]*"

///|
pub fn is_identifier(text : String) -> Bool {
  guard text =~ (IDENTIFIER) else { return false }
  true
}
