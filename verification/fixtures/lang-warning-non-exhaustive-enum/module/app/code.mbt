pub fn missing_future(x : @base.E) -> Int {
  match x { @base.A => 1; @base.B => 2 }
}
pub fn wildcard_hides_future(x : @base.E) -> Int {
  match x { @base.A => 1; @base.B => 2; _ => 0 }
}
pub fn missing_known(x : @base.E) -> Int {
  match x { @base.A => 1; @base.E::.. => 0 }
}
