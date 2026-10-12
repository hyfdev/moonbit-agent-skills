pub fn f() -> Unit {
  outer~: for i in 0..<1 {
    inner~: { if i == 0 { break inner~ } }
    break outer~
  }
}
