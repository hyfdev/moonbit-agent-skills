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
  ReleaseBase::base(value)
}

fn[T : ReleaseSub] release_single_constraint(value : T) -> Int {
  ReleaseBase::base(value)
}

fn[T : ReleaseBase + Eq] release_multiple_constraints(value : T) -> Int {
  if value == value {
    ReleaseBase::base(value)
  } else {
    0
  }
}

test "qualified supertrait calls" {
  let value = ReleaseSubject(1)
  let object = value as &ReleaseSub
  assert_eq(release_object_base(object), 1)
  assert_eq(release_single_constraint(value), 1)
  assert_eq(release_multiple_constraints(value), 1)
  assert_eq(object.sub(), 2)
}
