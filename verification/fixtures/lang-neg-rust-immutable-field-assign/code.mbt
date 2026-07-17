///|
pub(all) struct Counter {
  count : Int
}

///|
pub fn bump(c : Counter) -> Unit {
  c.count = c.count + 1
}
