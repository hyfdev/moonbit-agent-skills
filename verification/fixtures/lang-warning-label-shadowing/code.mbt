pub fn f() -> Unit {
  outer~: for i in 0..<1 {
    outer~: { if i == 0 { break outer~ } }
    break outer~
  }
}
