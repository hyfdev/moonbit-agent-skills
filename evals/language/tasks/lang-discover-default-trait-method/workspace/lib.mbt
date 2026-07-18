pub trait Describer {
  name(Self) -> String
  describe(Self) -> String = _
}

impl Describer with describe(self) {
  "item \{self.name()}"
}

pub(all) struct Item(String)

impl Describer for Item with name(self) {
  self.0
}

pub fn describe_qualified(item : Item) -> String {
  Describer::describe(item)
}
