fn known_then_future(x : @base.E) -> Int {
  match x { @base.A => 1; @base.B => 2; @base.E::.. => 0 }
}
fn intentionally_partial(x : @base.E) -> Int {
  match x { @base.A => 1; _ => 0 }
}
test "downstream non-exhaustive enum" {
  assert_eq(known_then_future(@base.A), 1)
  assert_eq(known_then_future(@base.B), 2)
  assert_eq(intentionally_partial(@base.B), 0)
}
