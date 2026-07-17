///|
pub(all) struct Point {
  x : Int
  y : Int
}

///|
impl Show for Point with output(self, logger) {
  logger.write_string("(\{self.x}, \{self.y})")
}
