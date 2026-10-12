///|
suberror E {
  E
}

///|
pub fn g() -> Int raise E {
  raise E
}

///|
pub fn h() -> Int raise E {
  g()
}
