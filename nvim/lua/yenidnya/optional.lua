--- Resolves modules that only exist when the private overlay is installed.

return function(name)
	local ok, module = pcall(require, name)
	if ok then
		return module
	end
	return nil
end
