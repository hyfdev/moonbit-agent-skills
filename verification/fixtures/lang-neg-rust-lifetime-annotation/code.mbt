///|
pub fn longest<'a>(x : &'a String, y : &'a String) -> &'a String {
  if x.length() > y.length() {
    x
  } else {
    y
  }
}
