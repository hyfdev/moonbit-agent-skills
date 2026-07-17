///|
pub(all) struct Counter {
  mut count : Int
}

///|
pub fn bump(c : Counter) -> Unit {
  c.count = c.count + 1
}
