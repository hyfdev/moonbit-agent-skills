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

test "QuickCheck filters before evaluation and bounds discarded inputs" {
  let mut evaluated = 0
  let report = @quickcheck.report(
    (_value : Int) => {
      evaluated += 1
      true
    },
    filter=_ => false,
    count=2U,
    discard_ratio=3U,
    seed=1UL,
  )
  assert_eq(evaluated, 0)
  debug_inspect(report, content="GaveUp(tests=0, discarded=6)")
}

test "QuickCheck reports labels, conditional classes, and collected values" {
  let report = @quickcheck.report(
    (_value : Unit) => true,
    count=2U,
    observe=_ => [
      @quickcheck.label("valid"),
      @quickcheck.classify(true, "present"),
      @quickcheck.classify(false, "absent"),
      @quickcheck.collect(7),
    ],
    seed=1UL,
  )
  debug_inspect(
    report,
    content=(
      #|Passed(
      #|  tests=2,
      #|  observations={
      #|    labels: { <List: ["7", "valid"]>: 2 },
      #|    classes: { "present": 2, "absent": 0 },
      #|  },
      #|)
    ),
  )
}
