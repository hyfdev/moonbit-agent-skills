///|
pub(all) struct Point {
  x : Int
  y : Int
}

///|
impl Show for Point {
  fn output(self : Point, logger : &Logger) -> Unit {
    logger.write_string("(\{self.x}, \{self.y})")
  }
}
