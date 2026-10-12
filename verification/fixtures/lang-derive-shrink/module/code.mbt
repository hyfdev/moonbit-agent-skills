priv struct ShrinkPair { x : Int; y : Int } derive(Shrink)
priv enum ShrinkShape { Empty; Pair(Int, Int) } derive(Shrink)
test "derived shrink changes one field at a time" {
  let candidates = @quickcheck.Shrink::shrink(ShrinkPair::{ x: 10, y: 20 }).collect()
  assert_true(candidates.length() > 0)
  assert_true(candidates[0].x != 10)
  assert_eq(candidates[0].y, 20)
  let mut saw_y = false
  for item in candidates {
    assert_true((item.x != 10 && item.y == 20) || (item.x == 10 && item.y != 20))
    if item.y != 20 { saw_y = true }
    if saw_y { assert_eq(item.x, 10) }
  }
  assert_true(saw_y)
}
test "derived enum shrink keeps constructor" {
  let empty : ShrinkShape = Empty
  assert_eq(@quickcheck.Shrink::shrink(empty).count(), 0)
  let candidates = @quickcheck.Shrink::shrink(ShrinkShape::Pair(10, 20)).collect()
  assert_true(candidates.length() > 0)
  for candidate in candidates { assert_true(candidate is Pair(_, _)) }
}
