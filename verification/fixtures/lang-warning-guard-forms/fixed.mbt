pub fn require_some(value : Int?) -> Int {
  guard! value is Some(result)
  result
}

pub fn exhaustive_guard(value : Int) -> Int {
  guard value is result
  result
}
