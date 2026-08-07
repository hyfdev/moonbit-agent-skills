pub fn break_from_labelled_loop() -> Int {
  let mut result = 0
  outer~: for i in 0..<3 {
    result = i
    if i == 1 {
      break outer~
    }
  }
  result
}

pub fn continue_labelled_loop() -> Int {
  let mut result = 0
  outer~: for i in 0..<3 {
    if i == 1 {
      continue outer~
    }
    result += i
  }
  result
}
