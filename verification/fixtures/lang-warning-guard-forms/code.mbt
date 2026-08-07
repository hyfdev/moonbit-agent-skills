pub fn redundant_guard_bang(value : Int) -> Int {
  guard! value is result
  result
}

pub fn redundant_guard_else(value : Int) -> Int {
  guard value is result else { 0 }
  result
}

pub fn require_some(value : Int?) -> Int {
  guard value is Some(result)
  result
}
