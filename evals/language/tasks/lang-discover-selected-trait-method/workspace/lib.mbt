pub trait Greeter {
  greet(Self) -> String
}

pub(all) struct Robot(String)

impl Greeter for Robot with greet(self) {
  "hello \{self.0}"
}

pub fn greet_qualified(robot : Robot) -> String {
  Greeter::greet(robot)
}
