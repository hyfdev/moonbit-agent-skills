// One declaration per visibility level; the client package (client/client.mbt)
// exercises what each level allows across the package boundary.

///|
struct DefaultStruct {
  x : Int
}

///|
pub struct ReadStruct {
  x : Int
}

///|
pub(all) struct AllStruct {
  mut x : Int
}

///|
priv struct PrivStruct {
  x : Int
}

///|
fn secret() -> Int {
  1
}

///|
pub fn open_fn() -> Int {
  2
}

///|
pub fn make_default() -> DefaultStruct {
  { x: 10 }
}

///|
pub fn make_read() -> ReadStruct {
  { x: 20 }
}

///|
pub(open) trait OpenTrait {
  f(Self) -> Int
}

///|
pub trait ClosedTrait {
  g(Self) -> Int
}

///|
test "vis: same-package access is unrestricted" {
  assert_eq(secret(), 1)
  let p = PrivStruct::{ x: 3 }
  assert_eq(p.x, 3)
  assert_eq(make_default().x, 10)
}
