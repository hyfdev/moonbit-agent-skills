///|
pub fn count_even(xs : Array[Int]) -> Int {
  let mut c = 0
  for x in xs {
    if @helpers.is_even(x) {
      c = c + 1
    }
  }
  c
}
