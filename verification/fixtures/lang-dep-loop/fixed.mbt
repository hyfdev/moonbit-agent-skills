pub fn sum_view(vs : ArrayView[Int]) -> Int {
  for acc = 0, v = vs {
    match v {
      [x, .. rest] => continue acc + x, rest
      [] => break acc
    }
  }
}
