///|
test "returns a present code" {
  assert_eq(@guard_intent_migration.require_code(Some(42)), 42)
}

///|
test "panic missing code violates the invariant" {
  ignore(@guard_intent_migration.require_code(None))
}
