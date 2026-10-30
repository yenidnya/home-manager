-- Mason as a catalogue for the packages that Nix installs (`neovimTools` in home.nix).
local M = {}

function M.setup()
	local managed = vim.g.nix_mason_packages or {}
	if #managed == 0 then
		return
	end

	require("mason-registry"):on("package:install:handle", function(handle)
		local name = handle.package.name
		if not vim.tbl_contains(managed, name) then
			return
		end
		-- The install runner listens for termination only after this event returns.
		vim.schedule(function()
			if not handle:is_closing() then
				handle:terminate()
			end
			vim.notify(name .. " is managed by Nix in home.nix, not Mason", vim.log.levels.WARN)
		end)
	end)

	vim.api.nvim_create_autocmd("FileType", {
		pattern = "mason",
		callback = function(args)
			vim.wo[vim.fn.bufwinid(args.buf)].winbar = " Managed by Nix: " .. table.concat(managed, ", ")
		end,
	})
end

return M
