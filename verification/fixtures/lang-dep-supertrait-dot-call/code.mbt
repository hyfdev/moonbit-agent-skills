priv trait ReleaseBase {
  base(Self) -> Int
}

priv trait ReleaseSub : ReleaseBase {
  sub(Self) -> Int
}

priv struct ReleaseSubject(Int) derive(Eq)

impl ReleaseBase for ReleaseSubject with base(self) {
  self.0
}

impl ReleaseSub for ReleaseSubject with sub(self) {
  self.0 + 1
}

fn release_object_base(value : &ReleaseSub) -> Int {
  value.base()
}

fn[T : ReleaseSub] release_single_constraint(value : T) -> Int {
  value.base()
}

fn[T : ReleaseBase + Eq] release_multiple_constraints(value : T) -> Int {
  if value == value {
    value.base()
  } else {
    0
  }
}

test "deprecated supertrait dot calls" {
  let value = ReleaseSubject(1)
  let object = value as &ReleaseSub
  assert_eq(release_object_base(object), 1)
  assert_eq(release_single_constraint(value), 1)
  assert_eq(release_multiple_constraints(value), 1)
  assert_eq(object.sub(), 2)
}
