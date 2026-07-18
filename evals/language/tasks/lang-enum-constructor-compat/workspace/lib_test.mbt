///|
test "classifies explicit file sources" {
  assert_eq(classify(Source::File("notes.mbt")), "file:notes.mbt")
}

///|
test "classifies explicit package sources" {
  assert_eq(
    classify(Source::Package("pkg:moonbit/core")),
    "package:pkg:moonbit/core",
  )
}

///|
test "preserves both enum variants" {
  assert_true(Source::File("a") is Source::File(_))
  assert_true(Source::Package("b") is Source::Package(_))
}
