///|
pub fn require_code(value : Int?) -> Int {
  guard value is Some(code)
  code
}
