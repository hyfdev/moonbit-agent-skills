///|
pub(all) suberror MyError {
  MyError
}

///|
pub fn f(x : Int) -> Int {
  if x < 0 {
    raise MyError
  }
  x
}
