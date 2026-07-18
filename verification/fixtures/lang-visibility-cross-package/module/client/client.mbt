// Cross-package view of the `vis` package (imported as @vis).
//
// Rejected operations, kept as comments because each one fails to compile
// (error codes from moonc v0.10.4):
//   @vis.secret()                          -> E4021 Value secret not found in package `vis`
//   @vis.make_default().x                  -> E4028 ... a abstract type and not a struct
//   let bad : @vis.ReadStruct = { x: 99 }  -> E4036 Cannot create values of the read-only type
//   let bad2 : @vis.PrivStruct = ...       -> E4032 The type @vis.PrivStruct is undefined
//   impl @vis.ClosedTrait for Mine with g(self) { 1 }
//                                          -> E4145 Cannot implement trait ... because it is readonly
//   pub(readonly) struct S { x : Int }     -> E4002 The pub(readonly) modifier is not supported here

///|
pub struct Mine {
  v : Int
}

///|
pub impl @vis.OpenTrait for Mine with f(self) {
  self.v
}

///|
pub extend Mine with @vis.OpenTrait::{f}

///|
pub fn make_mine(value : Int) -> Mine {
  { v: value }
}

///|
test "vis: allowed operations" {
  assert_eq(@vis.open_fn(), 2)
  let d : @vis.DefaultStruct = @vis.make_default() // abstract: the name is usable
  ignore(d)
  let r = @vis.make_read()
  assert_eq(r.x, 20) // pub: fields are readable
  let a : @vis.AllStruct = { x: 1 } // pub(all): external construction
  a.x = 5 // pub(all): external mutation of a mut field
  assert_eq(a.x, 5)
}

///|
test "vis: pub(open) trait implemented externally" {
  assert_eq(Mine::{ v: 7 }.f(), 7)
}
