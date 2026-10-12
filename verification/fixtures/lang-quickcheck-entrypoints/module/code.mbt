fn nonnegative_property(value : Int) -> Bool raise {
  if value < 0 { fail("negative input") }
  true
}

test "QuickCheck entrypoints" {
  @quickcheck.check(nonnegative_property, count=5U, filter=x => x >= 0, discard_ratio=100U, observe=x => [@quickcheck.label("valid"), @quickcheck.classify(x == 0, "zero"), @quickcheck.collect(x)], seed=1UL)
  let report = @quickcheck.report((x : Int) => x == x, count=5U, seed=1UL)
  ignore(report)
  let generator : @quickcheck.Generator[Int] = @quickcheck.pure(3).map(x => x + 1)
  assert_eq(generator.sample(seed=1UL), 4)
}

test "QuickCheck check raises when the property fails" {
  try @quickcheck.check((_x : Int) => false, count=1U, seed=1UL) catch {
    _ => ()
  } noraise {
    _ => fail("check must report the false property")
  }
}
