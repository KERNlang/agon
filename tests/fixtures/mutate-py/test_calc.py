from calc import add, either

assert add(2, 3) == 5
assert either(True, False) is True
assert either(False, False) is False
