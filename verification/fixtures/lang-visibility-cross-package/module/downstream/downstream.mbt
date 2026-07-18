fn[T : @vis.OpenTrait] trait_value(value : T) -> Int {
  @vis.OpenTrait::f(value)
}

test "public implementation and extension reach downstream" {
  let mine = @client.make_mine(9)
  assert_eq(trait_value(mine), 9)
  assert_eq(mine.f(), 9)
}
