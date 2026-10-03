# Testing Patterns

- **AAA Pattern**: Arrange, Act, Assert.
- **State over Interaction**: Assert on state output rather than internal mock method call sequences.
- **DAMP over DRY**: Keep tests self-contained and descriptive even if setup is repeated.
- **Fakes over Mocks**: Prefer real/in-memory fake implementations over brittle mock doubles.
