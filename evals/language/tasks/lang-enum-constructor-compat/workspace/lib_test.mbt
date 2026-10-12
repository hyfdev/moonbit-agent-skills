///|
test "classifies explicit file sources" {
  assert_eq(
    @enum_constructor_compat.classify(@enum_constructor_compat.Source::File("notes.mbt")),
    "file:notes.mbt",
  )
}

///|
test "classifies explicit package sources" {
  assert_eq(
    @enum_constructor_compat.classify(@enum_constructor_compat.Source::Package("pkg:moonbit/core")),
    "package:pkg:moonbit/core",
  )
}

///|
test "preserves both enum variants" {
  assert_true(
    @enum_constructor_compat.Source::File("a") is @enum_constructor_compat.Source::File(_),
  )
  assert_true(
    @enum_constructor_compat.Source::Package("b") is @enum_constructor_compat.Source::Package(_),
  )
}
